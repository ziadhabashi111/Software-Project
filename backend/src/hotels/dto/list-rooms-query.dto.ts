import { PaginationQueryDto } from '../../common/pagination/pagination';

/** Query for `GET /api/hotels/:id/rooms` (HTL-03, GEN-05: 10 rooms per page). */
export class ListRoomsQueryDto extends PaginationQueryDto {}
