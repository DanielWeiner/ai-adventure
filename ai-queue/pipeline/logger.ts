import { createLogger as createWinstonLogger, format, transports } from "winston";
const { AI_QUEUE_LOG } = process.env;

export const createLogger = () => createWinstonLogger({
    transports: [
        new transports.Console({
            format: format.combine(
                format.timestamp(),
                format.simple()
            ),
            silent: AI_QUEUE_LOG !== '1'
        })
    ],
});
