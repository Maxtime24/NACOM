import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth';
import postsRouter from './routes/posts';
import answersRouter from './routes/answers';
import categoriesRouter from './routes/categories';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// FRONTEND_URL은 쉼표(,)로 여러 주소 지정 가능
// 예: "https://gyesan-co.vercel.app,http://localhost:8081"
const FRONTEND_URLS = (process.env.FRONTEND_URL ?? 'http://localhost:8081')
  .split(',')
  .map(url => url.trim())
  .filter(Boolean);

// -----------------------------------------------
// 미들웨어
// -----------------------------------------------
app.use(cors({
  origin: [
    ...FRONTEND_URLS,
    /^http:\/\/localhost:\d+$/,    // 로컬 개발 환경 전체 허용
    /^http:\/\/192\.168\.\d+\.\d+:\d+$/, // 로컬 네트워크 (Expo Go)
    /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/, // 모든 외부 IP 허용 (테스트용)
  ],
  credentials: true,
}));
app.use(express.json({ limit: '15mb' }));  // 보안: 요청 크기 제한 (base64 이미지 10MB 대응)
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// -----------------------------------------------
// API Routes
// -----------------------------------------------
app.use('/api/auth', authRouter);
app.use('/api/posts', postsRouter);
app.use('/api/answers', answersRouter);
app.use('/api/categories', categoriesRouter);

// -----------------------------------------------
// 헬스 체크
// -----------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// -----------------------------------------------
// 전역 에러 핸들러 (보안: 상세 에러 숨김)
// -----------------------------------------------
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({
    message: process.env.NODE_ENV === 'production'
      ? '서버 오류가 발생했습니다.'
      : err.message,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ NACOM API Server running on http://0.0.0.0:${PORT} (accessible at http://13.209.42.194:${PORT})`);
});

export default app;
