import { getCached } from './cacheUser.js';
import { getRecord } from './dbUser.js';

console.log(`${getCached('k')}|${getRecord('i')}`);
