import { MessageFile } from 'eris';
import { BaseGlobalCommand, CommandContext, commandTypes, FlagResult } from '../core';

export class ArtCommand extends BaseGlobalCommand {
    public constructor() {
        super({
            name: 'art',
            category: commandTypes.IMAGE,
            description: 'Shows everyone a work of art.',
            flags: [{ flag: 'I', word: 'image', description: 'A custom image.' }],
            cooldown: 5000,
            definition: {
                parameters: '{user+?}',
                execute: (ctx, [user], flags) => this.art(ctx, user, flags),
                description: 'Shows everyone a work of art.'
            }
        });
        this.ratelimit.push(m => m.author.id);
        this.ratelimit.push(m => m.channel.id);
    }

    private async art(context: CommandContext, user: string | undefined, flags: FlagResult): Promise<void | string | MessageFile> {
        let url;
        if (context.message.attachments.length > 0) {
            url = context.message.attachments[0].url;
        } else if (flags.I !== undefined) {
            url = flags.I.merge().value;
        } else if (user !== undefined) {
            const u = await context.util.getUser(context, user);
            if (u === undefined)
                return;
            url = u.avatarURL;
        } else {
            url = context.author.avatarURL;
        }

        void context.discord.sendChannelTyping(context.channel.id);

        const buffer = await context.cluster.images.render('art', { avatar: url });
        if (buffer === undefined || buffer.length === 0)
            return this.error('Something went wrong while trying to render that!');

        return {
            file: buffer,
            name: 'sobeautifulstan.png'
        };

    }
}
