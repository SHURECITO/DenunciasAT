import { SetMetadata } from '@nestjs/common';
import { SKIP_JWT_KEY } from '../guards/jwt-auth.guard';

export const SkipJwt = () => SetMetadata(SKIP_JWT_KEY, true);
