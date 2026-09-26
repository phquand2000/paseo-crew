/** Where the plugin says what went wrong outside any one project: Paseo keeps it in the daemon's log. */
interface Logger {
  error(message: string, cause?: unknown): void;
  info(message: string): void;
}

const PREFIX = "seatworks-v2:";

/** The one place the plugin writes to the console. */
export const daemonLog: Logger = {
  error(message, cause) {
    if (cause === undefined) console.error(`${PREFIX} ${message}`);
    else console.error(`${PREFIX} ${message}`, cause);
  },
  info(message) {
    console.log(`${PREFIX} ${message}`);
  },
};
