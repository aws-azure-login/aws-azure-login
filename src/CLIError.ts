export class CLIError extends Error {
    /**
     * @param {string} message - The error message
     */
    constructor(message: string) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
        this.message = message;
    }
}
