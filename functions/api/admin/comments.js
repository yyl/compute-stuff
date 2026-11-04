import { api } from '../../../lib/comments/common.js';
import { adminGet, adminPost } from '../../../lib/comments/admin.js';
export const onRequestGet = api(adminGet);
export const onRequestPost = api(adminPost);
