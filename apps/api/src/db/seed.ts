import { pool } from './pool.js';

const demoUsers = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'reader.one@example.test',
    username: 'reader_one',
    displayName: 'Bạn đọc 1',
    role: 'user',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'reader.two@example.test',
    username: 'reader_two',
    displayName: 'Bạn đọc 2',
    role: 'user',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    email: 'admin@example.test',
    username: 'admin_readlite',
    displayName: 'Quản trị viên',
    role: 'admin',
  },
] as const;

const demoGenres = [
  { name: 'Văn học', slug: 'van-hoc' },
  { name: 'Psychological – Tâm lý', slug: 'psychological' },
  { name: 'Family – Gia đình', slug: 'family' },
] as const;

const demoStories = [
  {
    ownerId: demoUsers[2].id,
    remoteKey: 'seed:vet-nang-cuoi-ngay',
    title: 'Vệt nắng cuối ngày',
    author: 'An Nhiên',
    summary: 'Một câu chuyện nhỏ về những lần trở về và cơ hội bắt đầu lại.',
    visibility: 'public',
    genres: ['van-hoc', 'psychological'],
    chapters: [
      {
        title: 'Chuyến xe cuối ngày',
        content: 'Chiều hôm ấy, An lên chuyến xe cuối cùng để trở về quê nhà.',
      },
      {
        title: 'Ngôi nhà bên sông',
        content: 'Ngôi nhà vẫn ở đó, bên dòng sông lặng lẽ như ngày cô rời đi.',
      },
    ],
  },
  {
    ownerId: demoUsers[2].id,
    remoteKey: 'seed:can-phong-cua-so-xanh',
    title: 'Căn phòng có cửa sổ xanh',
    author: 'Minh Lam',
    summary: 'Những câu chuyện đời thường trong căn phòng nhìn ra khu vườn.',
    visibility: 'public',
    genres: ['van-hoc', 'family'],
    chapters: [
      {
        title: 'Cơn mưa đầu mùa',
        content: 'Tiếng mưa đánh thức căn phòng nhỏ và những ký ức đã ngủ quên.',
      },
      {
        title: 'Lá thư chưa gửi',
        content: 'Lá thư nằm trong ngăn bàn, chờ một ngày được viết tiếp.',
      },
    ],
  },
  {
    ownerId: demoUsers[0].id,
    remoteKey: 'seed:mua-he-trong-ngan-keo',
    title: 'Mùa hè trong ngăn kéo',
    author: 'ReadLite',
    summary: 'Truyện riêng tư mẫu của tài khoản Bạn đọc 1.',
    visibility: 'private',
    genres: ['psychological'],
    chapters: [
      {
        title: 'Tấm ảnh cũ',
        content: 'Tấm ảnh cũ được tìm thấy trong ngăn kéo vào một buổi sáng yên tĩnh.',
      },
      {
        title: 'Ngày mới',
        content: 'Ngoài cửa sổ, một ngày mới bắt đầu.',
      },
    ],
  },
] as const;

async function seed(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const user of demoUsers) {
      await client.query(
        `INSERT INTO users (
          id, email, username, password_hash, display_name, role, email_verified_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          username = EXCLUDED.username,
          display_name = EXCLUDED.display_name,
          role = EXCLUDED.role,
          is_active = true`,
        [
          user.id,
          user.email,
          user.username,
          'seed-only-no-login',
          user.displayName,
          user.role,
        ],
      );

      await client.query(
        `INSERT INTO user_settings (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING`,
        [user.id],
      );
    }

    const genreIds = new Map<string, string>();

    for (const genre of demoGenres) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO genres (name, slug)
        VALUES ($1, $2)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id`,
        [genre.name, genre.slug],
      );

      genreIds.set(genre.slug, result.rows[0].id);
    }

    for (const story of demoStories) {
      const storyResult = await client.query<{ id: string }>(
        `INSERT INTO stories (
          owner_id, title, author, summary, source, remote_key, visibility,
          moderation_status, ai_review_status
        )
        VALUES ($1, $2, $3, $4, 'manual', $5, $6, $7, $8)
        ON CONFLICT (owner_id, remote_key)
          WHERE owner_id IS NOT NULL AND remote_key IS NOT NULL
        DO UPDATE SET
          title = EXCLUDED.title,
          author = EXCLUDED.author,
          summary = EXCLUDED.summary,
          visibility = EXCLUDED.visibility,
          moderation_status = EXCLUDED.moderation_status,
          ai_review_status = EXCLUDED.ai_review_status
        RETURNING id`,
        [
          story.ownerId,
          story.title,
          story.author,
          story.summary,
          story.remoteKey,
          story.visibility,
          story.visibility === 'public' ? 'published' : 'draft',
          story.visibility === 'public' ? 'skipped' : 'not_started',
        ],
      );

      const storyId = storyResult.rows[0].id;

      for (const genreSlug of story.genres) {
        const genreId = genreIds.get(genreSlug);

        if (!genreId) {
          throw new Error(`Không tìm thấy thể loại mẫu: ${genreSlug}`);
        }

        await client.query(
          `INSERT INTO story_genres (story_id, genre_id)
          VALUES ($1, $2)
          ON CONFLICT (story_id, genre_id) DO NOTHING`,
          [storyId, genreId],
        );
      }

      for (const [index, chapter] of story.chapters.entries()) {
        const chapterOrder = index + 1;
        const wordCount = chapter.content.trim().split(/\s+/u).filter(Boolean).length;

        const existingChapter = await client.query<{ id: string }>(
          `SELECT id
          FROM chapters
          WHERE story_id = $1 AND chapter_order = $2`,
          [storyId, chapterOrder],
        );

        if (existingChapter.rows.length > 0) {
          await client.query(
            `UPDATE chapters
            SET title = $1, content = $2, word_count = $3
            WHERE id = $4`,
            [
              chapter.title,
              chapter.content,
              wordCount,
              existingChapter.rows[0].id,
            ],
          );
        } else {
          await client.query(
            `INSERT INTO chapters (
              story_id, chapter_order, title, content, word_count
            )
            VALUES ($1, $2, $3, $4, $5)`,
            [storyId, chapterOrder, chapter.title, chapter.content, wordCount],
          );
        }
      }
    }

    await client.query('COMMIT');
    console.info('Đã tạo dữ liệu mẫu ReadLite.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .catch((error: unknown) => {
    console.error('Không thể tạo dữ liệu mẫu ReadLite.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
