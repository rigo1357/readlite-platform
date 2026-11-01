import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (response.headersSent) {
    return _next(error);
  }

  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : 500;

  if (status === 404) {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Không tìm thấy tài nguyên.' },
    });
    return;
  }

  if (status === 400) {
    response.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'Dữ liệu gửi lên không hợp lệ.' },
    });
    return;
  }

  if (status === 413) {
    response.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Dữ liệu gửi lên vượt quá giới hạn cho phép.' },
    });
    return;
  }

  response.status(500).json({
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Đã xảy ra lỗi hệ thống.' },
  });
};
