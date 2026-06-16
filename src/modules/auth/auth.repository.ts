import prisma from "../../lib/prisma.js"

interface CreateUserData {
  email: string
  passwordHash: string
  name: string
  timezone: string
}

export const findUserByEmail = (email: string) => {
  return prisma.user.findUnique({ where: { email } })
}

export const findUserById = (id: string) => {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, timezone: true },
  })
}

export const createUser = (data: CreateUserData) => {
  return prisma.user.create({
    data,
    select: { id: true, email: true, name: true, timezone: true },
  })
}
