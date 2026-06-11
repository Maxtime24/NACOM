import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth';
import postsRouter from './routes/posts';
import answersRouter from './routes/answers';
import categoriesRouter from './routes/categories';

const app = express();
app.set('etag', false); // 304 응답으로 인한 트래픽/본문 이슈 방지를 위해 ETag 비활성화
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
interface HttpError extends Error {
  status?: number;
}

app.use((err: HttpError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status || 500;
  console.error('[ERROR]', err.message, err.stack);
  
  // 보안: 500 에러일 경우 구체적인 에러 평문을 노출하지 않고 마스킹 처리
  const message = status === 500 
    ? '서버 내부 오류가 발생했습니다.' 
    : err.message;

  res.status(status).json({ message });
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ NACOM API Server running on http://0.0.0.0:${PORT} (accessible at http://13.209.42.194:${PORT})`);
});

export default app;
