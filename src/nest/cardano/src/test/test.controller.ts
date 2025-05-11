// src/test/test.controller.ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { TestService } from './test.service';

@Controller('api/test')
export class TestController {
  constructor(private readonly testService: TestService) {}

  @Get('randomTx')            // /api/test/randomTx?count=10 形式
  async randomTxQuery(@Query('count') count?: string) {
    const num = parseInt(count ?? '1', 10);
    return this.testService.getRandomTxIds(isNaN(num) ? 1 : num);
  }

  @Get('randomTx/:count')     // /api/test/randomTx/10 形式
  async randomTxParam(@Param('count') count: string) {
    const num = parseInt(count, 10);
    return this.testService.getRandomTxIds(isNaN(num) ? 1 : num);
  }
}
