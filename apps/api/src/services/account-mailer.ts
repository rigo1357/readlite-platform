import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { env, type Environment } from '../config/env.js';

type AccountMail = { email: string; token: string };
export interface AccountMailer {
  sendVerification(message: AccountMail): Promise<void>;
  sendPasswordReset(message: AccountMail): Promise<void>;
}
type Message = {
  from: string;
  to: string;
  subject: string;
  text: string;
  disableFileAccess: boolean;
  disableUrlAccess: boolean;
};
type Transport = { sendMail(message: Message): Promise<unknown> };
type TransportFactory = (options: SMTPTransport.Options) => Transport;

export function createAccountMailer(
  configuration: Environment = env,
  transportFactory: TransportFactory = (options) => nodemailer.createTransport(options),
  logger: Pick<Console, 'info'> = console,
): AccountMailer {
  const smtp = configuration.email;
  // Creating a transport does not connect or send. Connections occur only for an explicit account request.
  const transport = smtp
    ? transportFactory({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        requireTLS: configuration.nodeEnv === 'production' && !smtp.secure,
        ...(smtp.user && smtp.password ? { auth: { user: smtp.user, pass: smtp.password } } : {}),
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
        disableFileAccess: true,
        disableUrlAccess: true,
        logger: false,
        debug: false,
      })
    : null;
  function link(path: string, token: string) {
    const url = new URL(path, smtp?.publicUrl ?? `http://localhost:${configuration.port}`);
    url.searchParams.set('token', token);
    return url.toString();
  }
  return {
    async sendVerification({ email, token }) {
      const url = link('/api/v1/auth/verify-email', token);
      if (!transport || !smtp) {
        if (configuration.nodeEnv === 'development')
          logger.info(`Link xác minh email dùng khi phát triển: ${url}`);
        return;
      }
      await transport.sendMail({
        from: smtp.from,
        to: email,
        subject: 'ReadLite — Xác minh email',
        text: `Chào bạn,\n\nMở liên kết để xác minh tài khoản ReadLite (hiệu lực 24 giờ):\n${url}\n\nNếu bạn không đăng ký, hãy bỏ qua email này.`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    },
    async sendPasswordReset({ email, token }) {
      const url = link('/api/v1/auth/reset-password', token);
      if (!transport || !smtp) {
        if (configuration.nodeEnv !== 'production')
          logger.info(`Token đặt lại mật khẩu dùng khi phát triển: ${token}`);
        return;
      }
      await transport.sendMail({
        from: smtp.from,
        to: email,
        subject: 'ReadLite — Đặt lại mật khẩu',
        text: `Bạn vừa yêu cầu đặt lại mật khẩu ReadLite.\n\nMở liên kết (hiệu lực 30 phút):\n${url}\n\nHoặc nhập mã sau trong màn hình Đặt lại mật khẩu của ứng dụng:\n${token}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    },
  };
}
export const accountMailer = createAccountMailer();
