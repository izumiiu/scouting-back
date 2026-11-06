import { AppError } from '../utils/errors.js';

/** Only whitelisted codes/numeric values are used. Never expose upstream bodies,
 * organization IDs, headers, or authentication details in stored/user errors. */
export async function providerError(
  response: Response,
  provider: string,
): Promise<AppError> {
  if (response.status === 413) {
    return new AppError(
      502,
      'AI_REQUEST_TOO_LARGE',
      `${provider} ปฏิเสธคำขอเพราะข้อมูลยาวเกินขีดจำกัด การรอหรือกดซ้ำด้วยข้อมูลเดิมไม่ช่วย กรุณาให้ผู้ดูแลตรวจขนาดคำขอและโควตาโมเดล`,
    );
  }
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'));
    const delay =
      Number.isFinite(seconds) && seconds > 0 && seconds <= 86400
        ? ` กรุณารออย่างน้อย ${Math.ceil(seconds)} วินาทีก่อนลองใหม่`
        : ' กรุณารอให้โควตาคืนหรือตรวจโควตาก่อนลองใหม่';
    return new AppError(
      502,
      'AI_RATE_LIMITED',
      `${provider} ใช้โควตาคำขอหรือ token ถึงขีดจำกัดแล้ว${delay}`,
    );
  }
  if (response.status === 400) {
    try {
      const body = (await response.json()) as { error?: { code?: unknown } };
      if (body?.error?.code === 'json_validate_failed')
        return new AppError(
          502,
          'INVALID_AI_OUTPUT',
          `${provider} สร้างผลวิเคราะห์ไม่ตรงรูปแบบ กรุณาลองวิเคราะห์ใหม่ภายหลัง`,
        );
    } catch {
      /* Retain the safe generic error below. */
    }
  }
  return new AppError(
    502,
    'AI_PROVIDER_ERROR',
    `${provider} ไม่สามารถประมวลผลคำขอนี้ได้ กรุณาตรวจ key สิทธิ์โมเดล และการตั้งค่า`,
  );
}
