import { ROLES_KEY } from '../../common/decorators';
import { UsersController } from './users.controller';

describe('UsersController authorization metadata', () => {
  it('restricts the member directory to team managers', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, UsersController.prototype.members);
    expect(roles).toEqual(['super_admin', 'ops_lead']);
  });
});
