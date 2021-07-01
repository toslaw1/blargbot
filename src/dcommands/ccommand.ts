import { createHmac } from 'crypto';
import { EmbedOptions, GuildChannel, MessageFile } from 'eris';
import moment from 'moment';
import { Duration } from 'moment-timezone';
import Snekfetch from 'snekfetch';
import { Cluster } from '../cluster';
import { SendPayload } from '../core/BaseUtilities';
import { getDocsEmbed, limits } from '../core/bbtag';
import { BaseCommand, CommandContext, CommandResult } from '../core/command';
import { Database, GuildAutoresponse, GuildFilteredAutoresponse, NamedStoredGuildCommand, NamedStoredRawGuildCommand } from '../core/database';
import { bbtagUtil, codeBlock, commandTypes, FlagDefinition, guard, humanize, parse, mapping } from '../utils';

type _ShrunkCommand = Omit<NamedStoredRawGuildCommand, 'author' | 'authorizer' | 'name'>;
type ShrunkCommand = { -readonly [P in keyof _ShrunkCommand]: _ShrunkCommand[P] }

interface ShrunkAutoresponse extends Omit<GuildAutoresponse, 'executes'> {
    executes: ShrunkCommand;
}

interface ShrunkFilteredAutoresponse extends ShrunkAutoresponse, Omit<GuildFilteredAutoresponse, 'executes'> {
    executes: ShrunkCommand;
}

interface Shrinkwrap {
    readonly cc: Record<string, ShrunkCommand>;
    readonly ar: ShrunkFilteredAutoresponse[];
    are: null | ShrunkAutoresponse
}

interface SignedShrinkwrap {
    readonly signature?: string;
    readonly payload: Shrinkwrap
}

export class CustomCommand extends BaseCommand {
    public constructor(cluster: Cluster) {
        super(cluster, {
            name: 'ccommand',
            aliases: ['cc'],
            category: commandTypes.ADMIN,
            info: 'Creates a custom command, using the BBTag language.\n\n'
                + 'Custom commands take precedent over all other commands. As such, you can use it to overwrite commands, or '
                + 'disable them entirely. If the command content is "null" (without the quotations), blargbot will have no output '
                + 'whatsoever, allowing you to disable any built-in command you wish. You cannot overwrite the \'ccommand\' command. '
                + 'For more in-depth command customization, see the `editcommand` command.\n'
                + `For more information about BBTag, visit <${cluster.util.websiteLink('/tags')}>.\n`
                + `By creating a custom command, you acknowledge that you agree to the Terms of Service (<${cluster.util.websiteLink('/tags/tos')}>)`,
            definition: {
                subcommands: {
                    'test|eval|exec|vtest': {
                        parameters: 'debug? {code+}',
                        execute: (ctx, [debug]) => this.runRaw(ctx, ctx.argRange(debug === undefined ? 1 : 2, true), '', debug !== undefined),
                        description: 'Uses the BBTag engine to execute the content as if it was a custom command'
                    },
                    'docs': {
                        parameters: '{topic*}',
                        execute: (ctx, [topic]) => this.showDocs(ctx, topic),
                        description: 'Returns helpful information about the specified topic.'
                    },
                    'debug': {
                        parameters: '{commandName} {args*}',
                        execute: (ctx, [commandName]) => this.runCommand(ctx, commandName, ctx.argRange(2, true), true),
                        description: 'Runs a custom command with some arguments. A debug file will be sent in a DM after the command has finished.'
                    },
                    'create|add': {
                        parameters: '{commandName?} {content*}',
                        execute: (ctx, [commandName]) => this.createCommand(ctx, commandName, ctx.argRange(2, true)),
                        description: 'Creates a new custom command with the content you give'
                    },
                    'edit': {
                        parameters: '{commandName?} {content*}',
                        execute: (ctx, [commandName]) => this.editCommand(ctx, commandName, ctx.argRange(2, true)),
                        description: 'Edits an existing custom command to have the content you specify'
                    },
                    'set': {
                        parameters: '{commandName?} {content*}',
                        execute: (ctx, [commandName]) => this.setCommand(ctx, commandName, ctx.argRange(2, true)),
                        description: 'Sets the custom command to have the content you specify. If the custom command doesnt exist it will be created.'
                    },
                    'delete|remove': {
                        parameters: '{commandName?}',
                        execute: (ctx, [commandName]) => this.deleteCommand(ctx, commandName),
                        description: 'Deletes an existing custom command'
                    },
                    'rename': {
                        parameters: '{oldName?} {newName?}',
                        execute: (ctx, [oldName, newName]) => this.renameCommand(ctx, oldName, newName),
                        description: 'Renames the custom command'
                    },
                    'raw': {
                        parameters: '{commandName?}',
                        execute: (ctx, [commandName]) => this.getRawCommand(ctx, commandName),
                        description: 'Gets the raw content of the custom command'
                    },
                    'list': {
                        parameters: '',
                        execute: (ctx) => this.listCommands(ctx),
                        description: 'Lists all custom commands on this server'
                    },
                    'cooldown': {
                        parameters: '{commandName} {duration?:duration}',
                        execute: (ctx, [commandName, duration]) => this.setCommandCooldown(ctx, commandName, duration),
                        description: 'Sets the cooldown of a custom command, in milliseconds'
                    },
                    'author': {
                        parameters: '{commandName?}',
                        execute: (ctx, [commandName]) => this.getCommandAuthor(ctx, commandName),
                        description: 'Displays the name of the custom command\'s author'
                    },
                    'flag|flags': {
                        parameters: '{commandName}',
                        execute: (ctx, [commandName]) => this.getCommandFlags(ctx, commandName),
                        description: 'Lists the flags the custom command accepts',
                        subcommands: {
                            'create|add': {
                                parameters: '{commandName} {flags+}',
                                execute: (ctx, [commandName, flags]) => this.addCommandFlags(ctx, commandName, flags),
                                description: 'Adds multiple flags to your custom command. Flags should be of the form `-<f> <flag> [flag description]`\n' +
                                    'e.g. `b!cc flags add myCommand -c category The category you want to use -n name Your name`'
                            },
                            'delete|remove': {
                                parameters: '{commandName} {flags+}',
                                execute: (ctx, [commandName, flags]) => this.removeCommandFlags(ctx, commandName, flags),
                                description: 'Removes multiple flags from your custom command. Flags should be of the form `-<f>`\n' +
                                    'e.g. `b!cc flags remove myCommand -c -n`'
                            }
                        }
                    },
                    'setlang': {
                        parameters: '{commandName} {language}',
                        execute: (ctx, [commandName, language]) => this.setCommandLanguage(ctx, commandName, language),
                        description: 'Sets the language to use when returning the raw text of your custom command'
                    },
                    'sethelp': {
                        parameters: '{commandName} {helpText*}',
                        execute: (ctx, [commandName]) => this.setCommandHelp(ctx, commandName, ctx.argRange(2, true)),
                        description: 'Sets the help text to show for the command'
                    },
                    'hide': {
                        parameters: '{commandName}',
                        execute: (ctx, [commandName]) => this.toggleCommandHidden(ctx, commandName),
                        description: 'Toggles whether the command is hidden from the command list or not'
                    },
                    'setRole': {
                        parameters: '{commandName} {roles*}',
                        execute: (ctx, [commandName, roles]) => this.setCommandRoles(ctx, commandName, roles),
                        description: 'Sets the roles that are allowed to use the command'
                    },
                    'shrinkwrap': {
                        parameters: '{commandNames+}',
                        execute: (ctx, [commandNames]) => this.shrinkwrapCommands(ctx, commandNames),
                        description: 'Bundles up the given commands into a single file that you can download and install into another server'
                    },
                    'install': {
                        parameters: '{shrinkwrapUrl?}',
                        execute: (ctx, [shrinkwrapUrl]) => this.installCommands(ctx, shrinkwrapUrl),
                        description: 'Bundles up the given commands into a single file that you can download and install into another server'
                    },
                    'import': {
                        parameters: '{tagName} {commandName?}',
                        execute: (ctx, [tagName, commandName]) => this.importCommand(ctx, tagName, commandName ?? tagName),
                        description: 'Imports a tag as a ccommand, retaining all data such as author variables'
                    }
                }
            }
        });
    }

    public async runRaw(
        context: CommandContext,
        content: string,
        input: string,
        debug: boolean
    ): Promise<string | { content: string, files: MessageFile } | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const args = humanize.smartSplit(input);
        const result = await this.cluster.bbtag.execute(content, {
            message: context.message,
            input: args,
            isCC: true,
            limit: new limits.CustomCommandLimit(),
            tagName: 'test',
            author: context.author.id
        });

        return debug ? bbtagUtil.createDebugOutput('test', content, args, result) : undefined;
    }

    private showDocs(ctx: CommandContext, topic: readonly string[]): SendPayload | string {
        const embed = getDocsEmbed(ctx, topic);
        if (!embed)
            return `❌ Oops, I didnt recognise that topic! Try using \`${ctx.prefix}${ctx.commandName} docs\` for a list of all topics`;

        return { embed: embed, isHelp: true };
    }

    public async runCommand(
        context: CommandContext,
        commandName: string,
        input: string,
        debug: boolean
    ): Promise<string | { content: string, files: MessageFile } | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestReadableCommand(context, commandName, false);
        if (typeof match !== 'object')
            return match;

        if (debug && match.author !== context.author.id)
            return '❌ You cannot debug someone elses custom command.';

        if (guard.isAliasedCustomCommand(match))
            return `❌ The command \`${commandName}\` is an alias to the tag \`${match.alias}\``;

        const args = humanize.smartSplit(input);
        const result = await this.cluster.bbtag.execute(match.content, {
            message: context.message,
            input: args,
            isCC: true,
            limit: new limits.CustomCommandLimit(),
            tagName: match.name,
            author: match.author,
            authorizer: match.authorizer,
            flags: match.flags,
            cooldown: match.cooldown
        });

        return debug ? bbtagUtil.createDebugOutput(match.name, match.content, args, result) : undefined;
    }

    public async createCommand(context: CommandContext, commandName: string | undefined, content: string | undefined): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestCreatableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        return await this.saveCommand(context, 'created', match.name, content);
    }

    public async editCommand(context: CommandContext, commandName: string | undefined, content: string | undefined): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestEditableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        if (guard.isAliasedCustomCommand(match))
            return `❌ The \`${commandName}\` custom command is an alias to the tag \`${match.alias}\``;

        return await this.saveCommand(context, 'edited', match.name, content, match);
    }

    public async deleteCommand(context: CommandContext, commandName: string | undefined): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestEditableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        await this.database.guilds.setCommand(context.channel.guild.id, match.name, undefined);
        return `✅ The \`${match.name}\` custom command is gone forever!`;
    }

    public async setCommand(context: CommandContext, commandName: string | undefined, content: string | undefined): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestSettableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        if (guard.isAliasedCustomCommand(match.command))
            return `❌ The \`${commandName}\` custom command is an alias to the tag \`${match.command.alias}\``;

        return await this.saveCommand(context, 'set', match.name, content, match.command);
    }

    public async renameCommand(context: CommandContext, oldName: string | undefined, newName: string | undefined): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const from = await this.requestEditableCommand(context, oldName);
        if (typeof from !== 'object')
            return from;

        const to = await this.requestCreatableCommand(context, newName);
        if (typeof to !== 'object')
            return to;

        await this.database.guilds.renameCommand(context.channel.guild.id, from.name, to.name);

        return `✅ The \`${from.name}\` custom command has been renamed to \`${to.name}\`.`;
    }

    public async getRawCommand(context: CommandContext, commandName: string | undefined): Promise<string | { content: string, files: MessageFile } | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestReadableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        if (guard.isAliasedCustomCommand(match))
            return `❌ The command \`${commandName}\` is an alias to the tag \`${match.alias}\``;

        const response = `✅ The raw code for \`${match.name}\` is:\n\`\`\`${match.lang}\n${match.content}\n\`\`\``;
        return response.length < 2000
            ? response
            : {
                content: `✅ The raw code for \`${match.name}\` is attached`,
                files: {
                    name: match.name + '.bbtag',
                    file: match.content
                }
            };
    }

    public async listCommands(context: CommandContext): Promise<{ embed: EmbedOptions } | string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const grouped: Record<string, string[]> = {};
        for (const command of await this.database.guilds.listCommands(context.channel.guild.id)) {
            const roles = command.roles === undefined || command.roles.length === 0 ? ['All Roles'] : command.roles;
            for (const role of roles) {
                (grouped[role] ??= []).push(command.name);
            }
        }
        return {
            embed: {
                title: 'List of custom commands',
                color: 0x7289da,
                fields: Object.entries(grouped)
                    .map(([role, commands]) => ({
                        name: role,
                        value: codeBlock(commands.join(', '), 'ini'),
                        inline: true
                    }))
            }
        };
    }

    public async setCommandCooldown(context: CommandContext, commandName: string, cooldown?: Duration): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        if (cooldown !== undefined && cooldown.asMilliseconds() < 0)
            return '❌ The cooldown must be greater than 0ms';

        const match = await this.requestEditableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        await this.database.guilds.setCommandProp(context.channel.guild.id, match.name, 'cooldown', cooldown?.asMilliseconds());
        cooldown ??= moment.duration();
        return `✅ The custom command \`${match.name}\` now has a cooldown of \`${humanize.duration(cooldown)}\`.`;
    }

    public async getCommandAuthor(context: CommandContext, commandName: string | undefined): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestReadableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        const response = [];
        const author = await this.database.users.get(match.author);
        response.push(`✅ The custom command \`${match.name}\` was made by **${humanize.fullName(author)}**`);
        if (match.authorizer !== undefined && match.authorizer !== match.author) {
            const authorizer = await this.database.users.get(match.authorizer);
            response.push(`and is authorized by **${humanize.fullName(authorizer)}**`);
        }

        return response.join(' ');
    }

    public async getCommandFlags(context: CommandContext, commandName: string): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestReadableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        const flagDefinitions = guard.isAliasedCustomCommand(match)
            ? (await this.cluster.database.tags.get(match.alias))?.flags ?? []
            : match.flags ?? [];

        const flags = humanize.flags(flagDefinitions);
        if (flags.length === 0)
            return `❌ The \`${match.name}\` custom command has no flags.`;

        return `✅ The \`${match.name}\` custom command has the following flags:\n\n${flags.join('\n')}`;
    }

    public async addCommandFlags(context: CommandContext, commandName: string, flagsRaw: string[]): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestEditableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        if (guard.isAliasedCustomCommand(match))
            return `❌ The \`${commandName}\` custom command is an alias to the tag \`${match.alias}\``;

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { undefined: _, ...addFlags } = parse.flags([], flagsRaw);
        const flags = [...(match.flags ?? [])];
        for (const flag of Object.keys(addFlags)) {
            const args = addFlags[flag];
            if (args === undefined || args.length === 0)
                return `❌ No word was specified for the \`${flag}\` flag`;

            if (flags.some(f => f.flag === flag))
                return `❌ The flag \`${flag}\` already exists!`;

            const word = args[0].replace(/[^a-z]/g, '').toLowerCase();
            if (flags.some(f => f.word === word))
                return `❌ A flag with the word \`${word}\` already exists!`;

            const desc = args.slice(1).join(' ').replace(/\n/g, ' ');
            flags.push({ flag, word, desc });
        }

        await this.database.guilds.setCommandProp(context.channel.guild.id, match.name, 'flags', flags);
        return `✅ The flags for \`${match.name}\` have been updated.`;
    }

    public async removeCommandFlags(context: CommandContext, commandName: string, flagsRaw: string[]): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestEditableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        if (guard.isAliasedCustomCommand(match))
            return `❌ The \`${commandName}\` custom command is an alias to the tag \`${match.alias}\``;

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { undefined: _, ...removeFlags } = parse.flags([], flagsRaw);
        const flags = [...(match.flags ?? [])]
            .filter(f => removeFlags[f.flag] === undefined);

        await this.database.guilds.setCommandProp(context.channel.guild.id, match.name, 'flags', flags);
        return `✅ The flags for \`${match.name}\` have been updated.`;
    }

    public async setCommandLanguage(context: CommandContext, commandName: string, language: string): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestEditableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        await this.database.guilds.setCommandProp(context.channel.guild.id, match.name, 'lang', language);
        return `✅ Lang for custom command \`${match.name}\` set.`;
    }

    public async setCommandHelp(context: CommandContext, commandName: string, helpText: string): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestEditableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        await this.database.guilds.setCommandProp(context.channel.guild.id, match.name, 'help', helpText);
        return `✅ Help text for custom command \`${match.name}\` set.`;
    }

    public async toggleCommandHidden(context: CommandContext, commandName: string): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestEditableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        const isNowHidden = !match.hidden;
        await this.database.guilds.setCommandProp(context.channel.guild.id, match.name, 'hidden', isNowHidden);
        return `✅ Custom command \`${match.name}\` is now ${isNowHidden ? 'hidden' : 'visible'}.`;
    }

    public async setCommandRoles(context: CommandContext, commandName: string, roleNames: string[]): Promise<string | undefined> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const match = await this.requestEditableCommand(context, commandName);
        if (typeof match !== 'object')
            return match;

        const roles = [];
        for (const roleName of roleNames) {
            const role = await context.cluster.util.getRole(context.message, roleName);
            if (role === null)
                return;
            roles.push(role);
        }

        await this.database.guilds.setCommandProp(context.channel.guild.id, match.name, 'roles', roles.map(r => r.id));
        return `✅ Roles for custom command \`${match.name}\` set to ${humanize.smartJoin(roles.map(r => `\`${r.name}\``), ', ', ' and ')}.`;
    }

    public async importCommand(context: CommandContext, tagName: string, commandName: string): Promise<string> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        commandName = normalizeName(commandName);
        if (await this.cluster.database.guilds.getCommand(context.channel.guild.id, commandName) !== undefined)
            return `❌ The \`${commandName}\` custom command already exists!`;

        const tag = await this.cluster.database.tags.get(tagName);
        if (tag === undefined)
            return `❌ The \`${tagName}\` tag doesnt exist!`;

        const author = await this.cluster.database.users.get(tag.author);
        await this.cluster.database.guilds.setCommand(context.channel.guild.id, commandName, {
            author: tag.author,
            alias: tagName,
            authorizer: context.author.id
        });
        return `✅ The tag \`${tag.name}\` by **${humanize.fullName(author)}** has been imported as \`${commandName}\` and is authorized by **${humanize.fullName(context.author)}**. ✅`;
    }

    public async shrinkwrapCommands(context: CommandContext, commandNames: string[]): Promise<CommandResult> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        const shrinkwrap: Shrinkwrap = { cc: {}, ar: [], are: null };
        const confirm = [
            'Salutations! You have discovered the super handy ShrinkWrapper9000!',
            '',
            'If you decide to proceed, this will:'
        ];

        const { commands, autoResponses, everythingAutoResponse } = await getShrinkwrapData(context.cluster.database, context.channel.guild.id);

        for (let commandName of commandNames) {
            commandName = commandName.toLowerCase();
            const command = commands[commandName];
            if (command === undefined || guard.isAliasedCustomCommand(command))
                continue;

            confirm.push(` - Export the custom command \`${commandName}\``);

            const ars = autoResponses[commandName];
            if (ars !== undefined) {
                for (const ar of ars) {
                    confirm.push(`   - Export the associated autoresponse to \`${ar.term}\`${ar.regex ? ' (regex)' : ''}`);
                    shrinkwrap.ar.push({ ...ar, executes: shrinkCommand(command) });
                }
            } else if (everythingAutoResponse?.executes === commandName) {
                confirm.push('   - Export the associated everything autoresponse');
                shrinkwrap.are = { executes: shrinkCommand(command) };
            } else {
                shrinkwrap.cc[commandName] = shrinkCommand(command);
            }
        }

        const key = 'thanks, shrinkwrapper!';
        confirm.push(
            'This will not:',
            ' - Export variables',
            ' - Export authors or authorizers',
            ' - Export depedencies',
            `If you wish to continue, please say \`${key}\``
        );

        const response = await context.cluster.util.awaitQuery(context.channel, context.author, confirm.join('\n'));
        if (response?.content !== key)
            return '✅ Maybe next time then.';

        return {
            content: '✅ No problem, my job here is done.',
            files: {
                file: JSON.stringify(<SignedShrinkwrap>{
                    signature: signShrinkwrap(shrinkwrap, this.config),
                    payload: shrinkwrap
                }, null, 2),
                name: 'shrinkwrap.json'
            }
        };
    }

    public async installCommands(context: CommandContext, shrinkwrapUrl?: string): Promise<string> {
        if (!guard.isGuildCommandContext(context))
            return '❌ Custom commands can only be used on guilds.';

        shrinkwrapUrl ??= context.message.attachments[0]?.url;
        if (shrinkwrapUrl === undefined)
            return '❌ You have to upload the installation file, or give me a URL to one.';

        const content = await requestSafe(shrinkwrapUrl);
        const signedShrinkwrap = mapSignedShrinkwrap(content);
        if (!signedShrinkwrap.valid)
            return '❌ Your installation file was malformed.';

        const confirm = [];
        const importSteps: Array<() => Promise<unknown>> = [];

        if (signedShrinkwrap.value.signature === undefined)
            confirm.push('⚠ **Warning**: This installation file is **unsigned**. It did not come from me. Please double check to make sure you want to go through with this.', '');
        else if (signedShrinkwrap.value.signature !== signShrinkwrap(signedShrinkwrap.value.payload, this.config)) {
            confirm.push('🛑 **Warning**: This installation file\'s signature is **incorrect**. There is a 100% chance that it has been tampered with. Please double check to make sure you want to go through with this.', '');
        }
        confirm.push(
            'Salutations! You have discovered the super handy CommandInstaller9000!',
            '',
            'If you decide to proceed, this will:'
        );


        const guildId = context.channel.guild.id;
        const { commands, autoResponses, everythingAutoResponse } = await getShrinkwrapData(context.cluster.database, guildId);
        const shrinkwrap = signedShrinkwrap.value.payload;
        for (const commandName of Object.keys(shrinkwrap.cc)) {
            if (commands.hasOwnProperty(commandName.toLowerCase())) {
                confirm.push(`❌ Ignore the command \`${commandName}\` as a command with that name already exists`);
                continue;
            }

            const command = shrinkwrap.cc[commandName];
            confirm.push(`✅ Import the command \`${commandName}\``);
            importSteps.push(async () => {
                await context.cluster.database.guilds.setCommand(guildId, commandName, {
                    ...command,
                    author: context.author.id
                });
            });
        }
        let arIndex = -1;
        let arCount = Object.values(autoResponses).reduce((c, a) => c + a.length, 0);
        for (const autoresponse of shrinkwrap.ar) {
            const arName = `\`${autoresponse.term}\`${autoresponse.regex ? ' (regex)' : ''}`;
            if (arCount++ >= 20) {
                confirm.push(`❌ Ignore the autoresponse to ${arName} as the limit has been reached.`);
                continue;
            }

            confirm.push(`✅ Import the autoresponse ${arName}`);
            importSteps.push(async () => {
                let commandName;
                while (commands[commandName = `_autoresponse_${++arIndex}`] !== undefined);
                await context.cluster.database.guilds.addAutoresponse(guildId, { ...autoresponse, executes: commandName });
                await context.cluster.database.guilds.setCommand(guildId, commandName, {
                    ...autoresponse.executes,
                    author: context.author.id,
                    hidden: true,
                    managed: true
                });
            });
        }
        if (shrinkwrap.are !== null) {
            const are = shrinkwrap.are;
            if (everythingAutoResponse !== undefined) {
                confirm.push('❌ Ignore everything autoresponse as one already exists');
            } else {
                confirm.push('✅ Import the autoresponse to everything');
                importSteps.push(async () => {
                    let commandName;
                    while (commands[commandName = `_autoresponse_${++arIndex}`] !== undefined);
                    await context.cluster.database.guilds.setAutoresponse(guildId, 'everything', { executes: commandName });
                    await context.cluster.database.guilds.setCommand(guildId, commandName, {
                        ...are.executes,
                        author: context.author.id,
                        hidden: true,
                        managed: true
                    });
                });
            }
        }

        const key = 'thanks, shrinkwrapper!';
        confirm.push(
            'This will also:',
            ' - Set you as the author for all imported commands',
            '',
            `If you wish to continue, please say \`${key}\``
        );

        const response = await context.cluster.util.awaitQuery(context.channel, context.author, confirm.join('\n'));
        if (response?.content !== key)
            return '✅ Maybe next time then.';

        for (const step of importSteps)
            await step();

        return '✅ No problem, my job here is done.';
    }

    private async saveCommand(
        context: CommandContext<GuildChannel>,
        operation: string,
        commandName: string,
        content: string | undefined,
        currentCommand?: NamedStoredRawGuildCommand
    ): Promise<string | undefined> {
        content = await this.requestCommandContent(context, content);
        if (content === undefined)
            return;

        const analysis = this.cluster.bbtag.check(content);
        if (analysis.errors.length > 0)
            return `❌ There were errors with the bbtag you provided!\n${bbtagUtil.stringifyAnalysis(analysis)}`;

        const command = {
            content: content,
            author: context.author.id,
            authorizer: context.author.id,
            hidden: currentCommand?.hidden ?? commandName.startsWith('_'),
            flags: currentCommand?.flags,
            cooldown: currentCommand?.cooldown,
            help: currentCommand?.help,
            lang: currentCommand?.lang,
            roles: currentCommand?.roles,
            uses: currentCommand?.uses
        };

        await this.database.guilds.setCommand(context.channel.guild.id, commandName, command);

        return `✅ Custom command \`${commandName}\` ${operation}.\n${bbtagUtil.stringifyAnalysis(analysis)}`;
    }
    private async requestCommandName(
        context: CommandContext<GuildChannel>,
        name: string | undefined,
        query = 'Enter the name of the custom command or type `c` to cancel:'
    ): Promise<string | undefined> {
        if (name !== undefined) {
            name = normalizeName(name);
            if (name.length > 0)
                return name;
        }

        if (query.length === 0)
            return undefined;

        name = (await this.util.awaitQuery(context.channel, context.author, query))?.content;
        if (name === undefined || name === 'c')
            return undefined;

        name = normalizeName(name);
        return name.length > 0 ? name : undefined;
    }

    private async requestCommandContent(
        context: CommandContext<GuildChannel>,
        content: string | undefined
    ): Promise<string | undefined> {
        if (content !== undefined && content.length > 0)
            return content;

        content = (await this.util.awaitQuery(context.channel, context.author, 'Enter the custom command\'s contents or type `c` to cancel:'))?.content;
        if (content === undefined || content === 'c')
            return undefined;

        return content.length > 0 ? content : undefined;
    }

    private async requestSettableCommand(
        context: CommandContext<GuildChannel>,
        commandName: string | undefined,
        allowQuery = true
    ): Promise<{ name: string, command?: NamedStoredGuildCommand } | string | undefined> {
        const match = await this.requestCommand(context, commandName, allowQuery);
        if (typeof match !== 'object')
            return match;

        return { name: match.name, command: match.command };
    }

    private async requestEditableCommand(
        context: CommandContext<GuildChannel>,
        commandName: string | undefined,
        { managed = false, hidden = true, allowQuery = true } = {}
    ): Promise<NamedStoredGuildCommand | string | undefined> {
        const match = await this.requestSettableCommand(context, commandName, allowQuery);
        if (typeof match !== 'object')
            return match;

        if (match.command === undefined)
            return `❌ The \`${match.name}\` custom command doesn\'t exist!`;

        if (!managed && 'managed' in match.command && match.command.managed)
            return `❌ The \`${match.name}\` custom command is a managed command`;

        if (!hidden && match.command.hidden)
            return `❌ The \`${match.name}\` custom command is a hidden command`;

        return match.command;
    }

    private async requestReadableCommand(
        context: CommandContext<GuildChannel>,
        commandName: string | undefined,
        allowQuery = true
    ): Promise<NamedStoredGuildCommand | string | undefined> {
        const match = await this.requestCommand(context, commandName, allowQuery);
        if (typeof match !== 'object')
            return match;

        if (match.command === undefined)
            return `❌ The \`${match.name}\` custom command doesn\'t exist!`;

        return match.command;
    }

    private async requestCreatableCommand(
        context: CommandContext<GuildChannel>,
        commandName: string | undefined,
        allowQuery = true
    ): Promise<{ name: string } | string | undefined> {
        const match = await this.requestCommand(context, commandName, allowQuery);
        if (typeof match !== 'object')
            return match;

        if (match.command !== undefined)
            return `❌ The \`${match.name}\` custom command already exists!`;

        return { name: match.name };
    }

    private async requestCommand(
        context: CommandContext<GuildChannel>,
        commandName: string | undefined,
        allowQuery: boolean
    ): Promise<{ name: string, command?: NamedStoredGuildCommand } | string | undefined> {
        commandName = await this.requestCommandName(context, commandName, allowQuery ? undefined : '');
        if (commandName === undefined)
            return;

        const command = await this.database.guilds.getCommand(context.channel.guild.id, commandName);
        if (command === undefined)
            return { name: commandName };

        return { name: command.name, command };
    }
}

function normalizeName(title: string): string {
    return title.replace(/[^\d\w .,\/#!$%\^&\*;:{}[\]=\-_~()<>]/gi, '').toLowerCase();
}

function shrinkCommand(command: NamedStoredRawGuildCommand): ShrunkCommand {
    return {
        content: command.content,
        cooldown: command.cooldown,
        flags: command.flags,
        help: command.help,
        hidden: command.hidden,
        lang: command.lang,
        managed: command.managed,
        roles: command.roles,
        uses: command.uses
    };
}

function signShrinkwrap(shrinkwrap: Shrinkwrap, config: Configuration): string {
    const content = JSON.stringify(shrinkwrap);
    return createHmac('sha256', config.general.interface_key).update(content).digest('hex');
}

// eslint-disable-next-line @typescript-eslint/ban-types
async function requestSafe(url: string): Promise<unknown> {
    try {
        const result = await Snekfetch.get(url);
        return result.body;
    } catch {
        return undefined;
    }
}

async function getShrinkwrapData(
    database: Database,
    guildId: string
): Promise<{
    commands: Record<string, NamedStoredGuildCommand>,
    autoResponses: Record<string, GuildFilteredAutoresponse[]>,
    everythingAutoResponse: GuildAutoresponse | undefined
}> {

    const autoresponses = await database.guilds.getAutoresponses(guildId);
    const commands = await database.guilds.listCommands(guildId);
    const commandMap: Record<string, NamedStoredGuildCommand> = {};
    const arMap: Record<string, GuildFilteredAutoresponse[]> = {};

    for (const command of commands) {
        commandMap[command.name] = command;
    }
    for (const ar of autoresponses.list ?? []) {
        (arMap[ar.executes] ??= []).push(ar);
    }

    return {
        commands: commandMap,
        autoResponses: arMap,
        everythingAutoResponse: autoresponses.everything
    };
}

const mapShrunkCommand = mapping.object<ShrunkCommand>({
    content: mapping.string,
    cooldown: mapping.optionalNumber,
    flags: mapping.array(
        mapping.object<FlagDefinition>({
            desc: mapping.string,
            word: mapping.string,
            flag: mapping.string
        }),
        { ifUndefined: mapping.result.undefined }
    ),
    help: mapping.optionalString,
    hidden: mapping.optionalBoolean,
    lang: mapping.optionalString,
    managed: mapping.optionalBoolean,
    roles: mapping.array(mapping.string, { ifUndefined: mapping.result.undefined }),
    uses: mapping.optionalNumber
});

const mapShrinkwrap = mapping.object<Shrinkwrap>({
    are: mapping.object<ShrunkAutoresponse | null>({
        executes: mapShrunkCommand
    }, { ifNull: mapping.result.null }),
    ar: mapping.array(
        mapping.object<ShrunkFilteredAutoresponse>({
            executes: mapShrunkCommand,
            regex: mapping.boolean,
            term: mapping.string
        })
    ),
    cc: mapping.record(mapShrunkCommand)
});

const mapSignedShrinkwrap = mapping.object<SignedShrinkwrap>({
    signature: mapping.optionalString,
    payload: mapping.any(mapping.json(mapShrinkwrap), mapShrinkwrap)
});
