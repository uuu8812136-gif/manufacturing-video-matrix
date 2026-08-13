import { Module } from '@nestjs/common';
import { ProductLibraryService } from './product-library.service';
import { ProductLibraryController } from './product-library.controller';

@Module({
  controllers: [ProductLibraryController],
  providers: [ProductLibraryService],
  exports: [ProductLibraryService],
})
export class ProductLibraryModule {}
