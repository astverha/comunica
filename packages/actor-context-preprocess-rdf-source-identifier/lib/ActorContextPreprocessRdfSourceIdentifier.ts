import {ActorContextPreprocess,
  IActorContextPreprocessOutput} from "@comunica/bus-context-preprocess";
import {DataSources, IDataSource, KEY_CONTEXT_SOURCES} from "@comunica/bus-rdf-resolve-quad-pattern";
import {IActionRdfSourceIdentifier, IActorRdfSourceIdentifierOutput} from "@comunica/bus-rdf-source-identifier";
import {ActionContext, Actor, IAction, IActorArgs, IActorTest, Mediator} from "@comunica/core";
import {AsyncReiterableArray} from "asyncreiterable";

/**
 * A comunica RDF Source Identifier Context Preprocess Actor.
 */
export class ActorContextPreprocessRdfSourceIdentifier extends ActorContextPreprocess {

  public readonly mediatorRdfSourceIdentifier: Mediator<Actor<IActionRdfSourceIdentifier, IActorTest,
    IActorRdfSourceIdentifierOutput>, IActionRdfSourceIdentifier, IActorTest, IActorRdfSourceIdentifierOutput>;

  constructor(args: IActorContextPreprocessRdfSourceIdentifierArgs) {
    super(args);
  }

  public async test(action: IAction): Promise<IActorTest> {
    return true;
  }

  public async run(action: IAction): Promise<IActorContextPreprocessOutput> {
    if (action.context && action.context.get(KEY_CONTEXT_SOURCES)) {
      const subContext: ActionContext = action.context.delete(KEY_CONTEXT_SOURCES);

      const endSource = () => {
        if (--remainingSources === 0) {
          newSources.push(null);
        }
      };

      const sources: DataSources = action.context.get(KEY_CONTEXT_SOURCES);
      const newSources: DataSources = AsyncReiterableArray.fromInitialEmpty();
      const identificationPromises: Promise<void>[] = [];
      let remainingSources = 1;
      const it = sources.iterator();
      it.on('data', (source: IDataSource) => {
        remainingSources++;
        if (source.type === 'auto') {
          identificationPromises.push(this.mediatorRdfSourceIdentifier.mediate(
            { sourceValue: source.value, context: subContext })
            .then((sourceIdentificationResult) => {
              if (sourceIdentificationResult.sourceType) {
                source.type = sourceIdentificationResult.sourceType;
              }
              newSources.push(source);
              endSource();
            }));
        } else {
          newSources.push(source);
          endSource();
        }
      });
      it.on('end', () => {
        endSource();
      });

      // If the sources are fixed, block until all sources are transformed.
      if (sources.isEnded()) {
        await new Promise((resolve) => it.on('end', resolve));
        await Promise.all(identificationPromises);
      }

      return { context: action.context.set(KEY_CONTEXT_SOURCES, newSources) };
    }
    return action;
  }

}

export interface IActorContextPreprocessRdfSourceIdentifierArgs
  extends IActorArgs<IAction, IActorTest, IActorContextPreprocessOutput> {
  mediatorRdfSourceIdentifier: Mediator<Actor<IActionRdfSourceIdentifier, IActorTest,
    IActorRdfSourceIdentifierOutput>, IActionRdfSourceIdentifier, IActorTest, IActorRdfSourceIdentifierOutput>;
}
