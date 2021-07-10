import { Binder, Binding, BindingResultIterator } from '../../../globalCore';
import { CommandBinderParseResult, CommandBinderState } from '../../../types';
import { CommandContext } from '../../CommandContext';
import { CommandBindingBase } from './CommandBindingBase';

export class ConcatBinding<TContext extends CommandContext, TResult> extends CommandBindingBase<TContext, TResult> {
    public constructor(
        public readonly name: string,
        protected readonly fallback: string | undefined,
        protected readonly raw: boolean,
        protected readonly next: ReadonlyArray<Binding<CommandBinderState<TContext>>>,
        protected readonly parse: (value: string, state: CommandBinderState<TContext>) => CommandBinderParseResult<TResult>
    ) {
        super();
    }

    public * debugView(): Generator<string> {
        yield `Concat ${this.raw ? 'raw ' : ''}values into variable '${this.name}'${this.fallback === undefined ? '' : ` with fallback of '${this.fallback}'`}`;
        for (const binding of this.next)
            for (const line of binding.debugView())
                yield `    ${line}`;
    }

    public *[Binder.binder](state: CommandBinderState<TContext>): BindingResultIterator<CommandBinderState<TContext>> {
        if (state.flags._.length === state.argIndex) {
            if (this.fallback !== undefined)
                yield this.getBindingResult(state, this.next, 0, this.parse(this.fallback, state));
            else
                yield this.bindingError(state, `❌ Not enough arguments! \`${this.name}\` is required`);
            return;
        }

        for (let i = 0; i <= state.flags._.length - state.argIndex; i++) {
            const args = state.flags._.merge(state.argIndex, state.argIndex + i + 1);
            const arg = this.raw ? args.raw : args.value;
            yield this.getBindingResult(state, this.next, i, this.parse(arg, state));
        }
    }
}
