import { Pipe, PipeTransform } from '@angular/core';
import { UserLookupHit } from '../../services/users-lookup.service';

@Pipe({
  name: 'usersSearchFilter',
  standalone: true,
})
export class UsersSearchFilterPipe implements PipeTransform {
  transform(
    users: UserLookupHit[] | null | undefined,
    query: string,
    excludeUids?: readonly string[] | null,
  ): UserLookupHit[] {
    if (!users?.length) return [];
    const exclude = excludeUids?.length ? new Set(excludeUids) : null;
    let list = exclude ? users.filter((u) => !exclude.has(u.uid)) : [...users];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) => {
      const name = (u.displayName ?? '').toLowerCase();
      const email = (u.email ?? '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }
}
