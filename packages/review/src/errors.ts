/** 상태 코드가 있는 오류 — 서버가 그 코드와 message로 답하고, 페이지는 message를 그 자리에 보인다 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 명령의 실패 — code가 종료 코드다(사용법 2, 그 밖 1) */
export class CliError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
