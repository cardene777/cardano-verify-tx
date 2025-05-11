import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { MerkleModule } from './merkle/merkle.module';
import { VerifyModule } from './verify/verify.module';
import { TestModule } from './test/test.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MerkleModule,
    TestModule,
    VerifyModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
