/**
 * SMTP email sending (replaces AWS SES). Point at MailPit in development.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { getConfig } from "@provena/config";

let transporter: Transporter | undefined;

const getTransporter = (): Transporter => {
  if (!transporter) {
    const config = getConfig();
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      ...(config.SMTP_USER
        ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? "" } }
        : {}),
    });
  }
  return transporter;
};

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
}

export const sendEmail = async (input: SendEmailInput): Promise<void> => {
  const config = getConfig();
  await getTransporter().sendMail({
    from: config.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    text: input.body,
  });
};

export const resetEmailTransport = (): void => {
  transporter = undefined;
};
