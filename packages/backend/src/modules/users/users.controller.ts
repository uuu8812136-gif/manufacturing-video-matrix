import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { InviteMemberDto, UpdateProfileDto, UpdateRoleDto } from './dto/user.dto';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { RequestUser } from '../../common/decorators';

@ApiBearerAuth()
@ApiTags('用户与团队')
@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('profile')
  @ApiOperation({ summary: '获取当前用户信息' })
  profile(@CurrentUser() user: RequestUser) {
    return this.usersService.profile(user.id);
  }

  @Patch('profile')
  @ApiOperation({ summary: '更新个人信息' })
  updateProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Get('members')
  @ApiOperation({ summary: '团队成员列表' })
  @Roles('super_admin', 'ops_lead')
  members(@CurrentUser() user: RequestUser) {
    return this.usersService.listMembers(user.teamId);
  }

  @Post('members')
  @ApiOperation({ summary: '邀请成员' })
  @Roles('super_admin', 'ops_lead')
  invite(@CurrentUser() user: RequestUser, @Body() dto: InviteMemberDto) {
    return this.usersService.invite(user.teamId, user.role, dto);
  }

  @Patch('members/:id/role')
  @ApiOperation({ summary: '修改成员角色' })
  @Roles('super_admin', 'ops_lead')
  updateRole(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.usersService.updateRole(user.teamId, user.id, user.role, id, dto.role);
  }

  @Delete('members/:id')
  @ApiOperation({ summary: '移除团队成员' })
  @Roles('super_admin', 'ops_lead')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.usersService.remove(user.teamId, user.id, user.role, id);
  }
}
