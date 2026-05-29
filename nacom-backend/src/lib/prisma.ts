import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// DATABASE_URL 문자열을 파싱하는 헬퍼 함수
function parseDatabaseUrl(url: string) {
  // 형식: mysql://user:pass@host:port/database
  const regex = /^mysql:\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?\/([^?]+)/;
  const match = url.match(regex);
  if (!match) {
    throw new Error('올바르지 않은 DATABASE_URL 형식입니다.');
  }
  return {
    user: decodeURIComponent(match[1]),
    password: decodeURIComponent(match[2]),
    host: match[3],
    port: match[4] ? parseInt(match[4], 10) : 3306,
    database: match[5],
  };
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL 환경 변수가 필요합니다.');
}

const dbConfig = parseDatabaseUrl(process.env.DATABASE_URL);
const adapter = new PrismaMariaDb({
  ...dbConfig,
  connectionLimit: 10,
});

// 개발 환경에서 핫 리로드 시 중복 연결 방지
const prisma = global.prisma ?? new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export default prisma;

