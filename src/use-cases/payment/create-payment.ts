import { CreatePaymentRepository } from "../../repositories/payment/create-payment";
import { EmailNotificationUseCase } from "../email-notification/email-notification";

import {
  mercadopago,
  Payment as MercadoPagoPayment,
} from "../../config/mercadopago";
import { isValidCpf, removeCpfPunctuation } from "../../utils/cpf";
import { Payment } from "../../types/payment";
import { EmailStatus } from "../../types/email-notification";
import { paymentSchema } from "../../schemas/payment/payment";

export class CreatePaymentUseCase {
  constructor(
    private createPaymentRepository: CreatePaymentRepository,
    private emailNotificationUseCase: EmailNotificationUseCase,
  ) {
    this.createPaymentRepository = createPaymentRepository;
    this.emailNotificationUseCase = emailNotificationUseCase;
  }

  async execute(createPaymentParams: Payment & { token?: string }) {
    if (!createPaymentParams.cpf) {
      throw new Error("CPF não informado.");
    }
    const cpfSemPontuacao = removeCpfPunctuation(createPaymentParams.cpf);
    if (!isValidCpf(cpfSemPontuacao)) {
      throw new Error("CPF inválido.");
    }

    if (!createPaymentParams.name) {
      throw new Error("Nome não informado.");
    }
    const [firstName, ...rest] = createPaymentParams.name.split(" ");
    const lastName = rest.join(" ") || "-";

    const payer: any = {
      email: createPaymentParams.recipient,
      first_name: firstName,
      last_name: lastName,
      identification: {
        type: "CPF",
        number: cpfSemPontuacao,
      },
    };

    if (createPaymentParams.payer?.address) {
      payer.address = createPaymentParams.payer.address;
    } else if (
      createPaymentParams.zip_code &&
      createPaymentParams.street_name &&
      createPaymentParams.street_number &&
      createPaymentParams.neighborhood &&
      createPaymentParams.city &&
      createPaymentParams.federal_unit
    ) {
      payer.address = {
        zip_code: createPaymentParams.zip_code,
        street_name: createPaymentParams.street_name,
        street_number: createPaymentParams.street_number,
        neighborhood: createPaymentParams.neighborhood,
        city: createPaymentParams.city,
        federal_unit: createPaymentParams.federal_unit,
      };
    }

    await paymentSchema.parseAsync(createPaymentParams);

    const paymentBody: any = {
      transaction_amount: createPaymentParams.amount,
      payment_method_id: createPaymentParams.paymentMethod,
      payer,
      description: `Plano: ${createPaymentParams.plan}`,
      metadata: {
        userId: createPaymentParams.userId,
        plan: createPaymentParams.plan,
      },
      installments: createPaymentParams.installments || 1,
    };

    if (
      createPaymentParams.paymentMethod === "visa" ||
      createPaymentParams.paymentMethod === "master" ||
      createPaymentParams.paymentMethod === "amex"
    ) {
      if (!createPaymentParams.token) {
        throw new Error("Token do cartão não informado.");
      }
      paymentBody.token = createPaymentParams.token;
    }

    const mpPayment = new MercadoPagoPayment(mercadopago);

    const paymentResponse = await mpPayment.create({
      body: paymentBody,
    });

    const { token, ...paymentData } = createPaymentParams;

    const payment = await this.createPaymentRepository.execute({
      ...paymentData,
      status: "PENDING",
      externalId: String(paymentResponse.id),
    });

    const emailNotification = await this.emailNotificationUseCase.execute({
      ...createPaymentParams,
      recipient: createPaymentParams.recipient,
      subject: "Confirmação de Pagamento",
      content: `Obrigado por seu pagamento. Você adquiriu o plano: ${createPaymentParams.plan}.`,
      status: EmailStatus.PENDING,
    });

    return { payment, emailNotification, mercadoPago: paymentResponse };
  }
}
