export type UserRole = 'admin' | 'agent' | 'customer';

export interface JwtUser {
  sub: string; // user id
  tenantId: string;
  role: UserRole;
  email: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}
