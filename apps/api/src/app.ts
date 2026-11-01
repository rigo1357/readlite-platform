import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { createSessionStatusGuard } from './middleware/session-status.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import cookieParser from 'cookie-parser';
import { catalogRouter } from './routes/catalog.js';
import { libraryRouter } from './routes/library.js';
import { mediaRouter } from './routes/media.js';
import { storySubmissionRouter } from './routes/story-submissions.js';
import { authorStoriesRouter } from './routes/author-stories.js';
import { adminReviewRouter } from './routes/admin-review.js';
import { adminUsersRouter } from './routes/admin-users.js';
import { reviewsRouter } from './routes/reviews.js';
import { commentsRouter } from './routes/comments.js';
import { reportsRouter } from './routes/reports.js';
import { recommendationsRouter } from './routes/recommendations.js';
import { bookmarksRouter } from './routes/bookmarks.js';
import { readerUpdatesRouter } from './routes/reader-updates.js';
import { contentUpdatesRouter } from './routes/content-updates.js';
import { storyLifecycleRouter } from './routes/story-lifecycle.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigins,
    credentials: true,
  }),
);
app.use('/api/v1/author/stories/manual', express.json({ limit: '12mb' }));
app.use('/api/v1/author/stories/:storyId/updates', express.json({ limit: '12mb' }));
app.use('/api/v1/author/content-updates', express.json({ limit: '12mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api/v1', createSessionStatusGuard());
app.use('/api/v1', healthRouter);
app.use('/api/v1', authRouter);
app.use('/api/v1', libraryRouter);
app.use('/api/v1', mediaRouter);
app.use('/api/v1', storySubmissionRouter);
app.use('/api/v1', authorStoriesRouter);
app.use('/api/v1', adminReviewRouter);
app.use('/api/v1', adminUsersRouter);
app.use('/api/v1', reviewsRouter);
app.use('/api/v1', commentsRouter);
app.use('/api/v1', reportsRouter);
app.use('/api/v1', recommendationsRouter);
app.use('/api/v1', bookmarksRouter);
app.use('/api/v1', readerUpdatesRouter);
app.use('/api/v1', contentUpdatesRouter);
app.use('/api/v1', storyLifecycleRouter);
app.use('/api/v1', catalogRouter);

app.use((_request, response) => {
  response.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Không tìm thấy tài nguyên.' },
  });
});

app.use(errorHandler);
