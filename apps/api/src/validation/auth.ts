import { z } from 'zod';

const emailSchema = z
  .string()
  .trim()
  .min(1)
  .max(254)
  .email()
  .transform((email) => email.toLowerCase());

const usernameSchema = z
  .string()
  .trim()
  .min(4)
  .max(20)
  .transform((username) => username.toLowerCase());

const passwordSchema = z
  .string()
  .min(8)
  .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, {
    message: 'Mật khẩu vượt quá độ dài được hỗ trợ.',
  });

const displayNameSchema = z.string().trim().min(1).max(100);

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(32).max(128),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1)
    .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, {
      message: 'Mật khẩu vượt quá độ dài được hỗ trợ.',
    }),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(32).max(128),
  password: passwordSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: passwordSchema,
    password: passwordSchema,
  })
  .strict();

export const updateProfileSchema = z
  .object({
    username: usernameSchema.optional(),
    displayName: displayNameSchema.optional(),
  })
  .refine((value) => value.username !== undefined || value.displayName !== undefined, {
    message: 'Cần cập nhật ít nhất một trường.',
  });

export const deleteAccountSchema = z.object({
  password: passwordSchema,
});
