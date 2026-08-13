import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('login with seed account returns accessToken', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ phone: '13800000000', password: 'admin123' })
      .expect(201);

    expect(res.body).toHaveProperty('data');
    const data = res.body.data || res.body;
    expect(data).toHaveProperty('accessToken');
    expect(typeof data.accessToken).toBe('string');
  }, 15000);

  it('login with wrong password fails', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ phone: '13800000000', password: 'wrong' })
      .expect(401);
  }, 15000);

  it('protected route without token returns 401', async () => {
    await request(app.getHttpServer())
      .get('/api/accounts')
      .expect(401);
  });
});
