/** 상태 코드가 있는 오류 — 서버가 그 코드와 message로 답하고, 페이지는 message를 그 자리에 보인다 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
