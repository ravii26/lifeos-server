import type { Response } from "express"
import { HttpStatus } from "../constants/httpStatus.js"
import { translate, SUPPORTED_LANGUAGES } from "./i18n.js"

const getRequestLanguage = (res: Response): string => {
  const req = res.req
  const lang =
    (req?.user?.language ||
      req?.headers?.["accept-language"] ||
      req?.headers?.["x-language"]) as string | undefined || "en"

  const short = lang.substring(0, 2).toLowerCase()
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(short) ? short : "en"
}

export const sendSuccess = (
  res: Response,
  message: string,
  data: unknown = null,
  statusCode: number = HttpStatus.OK,
) => {
  const lang = getRequestLanguage(res)
  return res.status(statusCode).json({
    success: true,
    message: translate(message, lang),
    data,
  })
}

export const sendError = (
  res: Response,
  message: string,
  statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR,
  errors: unknown = null,
) => {
  const lang = getRequestLanguage(res)
  return res.status(statusCode).json({
    success: false,
    message: translate(message, lang),
    errors,
  })
}
