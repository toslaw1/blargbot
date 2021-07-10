import { BaseGuildCommand, commandTypes, GuildCommandContext, humanize, ModerationType, parse, FlagResult } from '../core';

export class WarnCommand extends BaseGuildCommand {
    public constructor() {
        super({
            name: 'warn',
            category: commandTypes.ADMIN,
            flags: [
                { flag: 'r', word: 'reason', description: 'The reason for the warning.' },
                {
                    flag: 'c',
                    word: 'count',
                    description: 'The number of warnings that will be issued.'
                }
            ],
            definition: {
                parameters: '{user+}',
                description: 'Issues a warning.\n' +
                    'If mod-logging is enabled, the warning will be logged.\n' +
                    'If `kickat` and `banat` have been set using the `settings` command, the target could potentially get banned or kicked.',
                execute: (ctx, [user], flags) => this.warn(ctx, user.join(' '), flags)
            }
        });
    }

    public async warn(context: GuildCommandContext, user: string, flags: FlagResult): Promise<string> {
        const member = await context.util.getMember(context.message, user);
        if (member === undefined)
            return '❌ I couldn\'t find that user!';

        const reason = flags.r?.merge().value;
        const count = parse.int(flags.c?.merge().value ?? 1);

        const result = await context.cluster.moderation.warns.warn(member, context.author, count, reason);
        const preamble = `**${humanize.fullName(member)}** has been given ${count === 1 ? 'a warning' : `${count} warnings`}.`;
        const actionStr = getActionString(result.type);
        switch (result.state) {
            case 'countNaN': return `❌ ${flags.c?.merge().value ?? ''} isnt a number!`;
            case 'countNegative': return '❌ I cant give a negative amount of warnings!';
            case 'countZero': return '❌ I cant give zero warnings!';
            case 'alreadyBanned': return `⚠️ ${preamble}\n⛔ They went over the limit for bans, but they were already banned.`;
            case 'memberTooHigh': return `⚠️ ${preamble}\n⛔ They went over the limit for ${actionStr}s but they are above me so I couldnt ${actionStr} them.`;
            case 'moderatorTooLow': return `⚠️ ${preamble}\n⛔ They went over the limit for ${actionStr}s but they are above you so I didnt ${actionStr} them.`;
            case 'noPerms': return `⚠️ ${preamble}\n⛔ They went over the limit for ${actionStr}s but I dont have permission to ${actionStr} them.`;
            case 'moderatorNoPerms': return `⚠️ ${preamble}\n⛔ They went over the limit for ${actionStr}s but you dont have permission to ${actionStr} them.`;
            case 'success': {
                switch (result.type) {
                    case ModerationType.WARN: return `✅ ${preamble} They now have ${result.count} warnings.`;
                    case ModerationType.BAN: return `✅ ${preamble} They went over the limit for bans and so have been banned.`;
                    case ModerationType.KICK: return `✅ ${preamble} They went over the limit for kicks and so have been kicked.`;
                }
            }
        }
    }
}

function getActionString(type: ModerationType): string {
    switch (type) {
        case ModerationType.BAN: return 'ban';
        case ModerationType.KICK: return 'kick';
        case ModerationType.WARN: return 'warn';
    }
}
