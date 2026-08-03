export const EXIT = {
  ok: 0,
  /** Something went wrong: network, configuration, settlement. */
  error: 1,
  /** The payment was refused by the local spending policy. */
  blocked: 2,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** An error whose message is already user-facing, printed without a stack trace. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode = EXIT.error,
  ) {
    super(message);
    this.name = "CliError";
  }
}
