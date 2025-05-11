// src/verify/verify.controller.ts
import { Controller, Post, Body, HttpException } from '@nestjs/common';
import { VerifyService } from './verify.service';

@Controller('api/verify')
export class VerifyController {
  constructor(private readonly verifyService: VerifyService) {}

  /**
   * POST /api/verify/tx
   * body: { "txIds": ["abcd...", "efgh..."] }
   */
  @Post('tx')
  async verifyTx(@Body() body: { txIds?: string[] }) {
    /* サービス側でも空チェックするが、
       ここで undefined の場合は空配列を渡す */
    const txIds = body.txIds ?? [];

    try {
      return await this.verifyService.verifyTxIds(txIds);
    } catch (e) {
      /* VerifyService からの HttpException をそのまま投げ直す */
      if (e instanceof HttpException) throw e;
      throw new HttpException(
        { ok: false, results: [], message: '内部サーバーエラー' },
        500,
      );
    }
  }
}
