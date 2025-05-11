import { Controller, Post, HttpException } from '@nestjs/common';
import { MerkleService } from './merkle.service';

@Controller('api/merkle')
export class MerkleController {
  constructor(private readonly merkleService: MerkleService) {}

  @Post('process')
  async process() {
    try {
      return await this.merkleService.process();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new HttpException('内部サーバーエラー', 500);
    }
  }
}
