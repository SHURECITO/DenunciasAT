import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { RagProxyService } from './rag.service';

@Module({
  controllers: [RagController],
  providers: [RagProxyService],
})
export class RagModule {}
