import {IActionHttp, IActorHttpOutput} from "@comunica/bus-http";
import {ActorRdfDereference, IActionRdfDereference, IActorRdfDereferenceOutput} from "@comunica/bus-rdf-dereference";
import {IActionRdfParse, IActionRootRdfParse, IActorOutputRootRdfParse, IActorRdfParseOutput,
  IActorTestRootRdfParse} from "@comunica/bus-rdf-parse";
import {Actor, IActorArgs, IActorTest, Mediator} from "@comunica/core";
import {EmptyIterator} from "asynciterator";

/**
 * An actor that listens on the 'rdf-dereference' bus.
 *
 * It starts by grabbing all available RDF media types from the RDF parse bus.
 * After that, it resolves the URL using the HTTP bus using an accept header compiled from the available media types.
 * Finally, the response is parsed using the RDF parse bus.
 */
export class ActorRdfDereferenceHttpParse extends ActorRdfDereference implements IActorRdfDereferenceHttpParseArgs {

  public static readonly REGEX_MEDIATYPE: RegExp = /^[^ ;]*/;

  public readonly mediatorHttp: Mediator<Actor<IActionHttp, IActorTest, IActorHttpOutput>,
    IActionHttp, IActorTest, IActorHttpOutput>;
  public readonly mediatorRdfParse: Mediator<Actor<IActionRootRdfParse, IActorTestRootRdfParse,
    IActorOutputRootRdfParse>, IActionRootRdfParse, IActorTestRootRdfParse, IActorOutputRootRdfParse>;

  constructor(args: IActorRdfDereferenceHttpParseArgs) {
    super(args);
  }

  public async test(action: IActionRdfDereference): Promise<IActorTest> {
    if (!action.url.startsWith("http:") && !action.url.startsWith("https:")) {
      throw new Error('This actor can only handle URLs that start with \'http\' or \'https\'.');
    }
    return true;
  }

  public async run(action: IActionRdfDereference): Promise<IActorRdfDereferenceOutput> {
    // Define accept header based on available media types.
    const mediaTypes: {[id: string]: number} = (await this.mediatorRdfParse.mediate(
      { context: action.context, mediaTypes: true }))
      .mediaTypes;
    const acceptHeader: string = this.mediaTypesToAcceptString(mediaTypes);

    // Resolve HTTP URL using appropriate accept header
    const headers: Headers = new Headers();
    headers.append('Accept', acceptHeader);
    const httpAction: IActionHttp = { context: action.context, input: action.url, init: { headers } };
    let httpResponse: IActorHttpOutput;
    try {
      httpResponse = await this.mediatorHttp.mediate(httpAction);
    } catch (e) {
      if (action.silenceErrors) {
        this.logWarn(action.context, `Could not retrieve ${action.url}: ${e.message}`,
          { actor: this.name });
        return { pageUrl: action.url, quads: new EmptyIterator(), triples: true };
      } else {
        throw new Error(`Could not retrieve ${action.url}: ${e.message}`);
      }
    }

    // Wrap WhatWG readable stream into a Node.js readable stream
    // If the body already is a Node.js stream (in the case of node-fetch), don't do explicit conversion.
    const responseStream: NodeJS.ReadableStream = require('is-stream')(httpResponse.body)
      ? httpResponse.body : require('node-web-streams').toNodeReadable(httpResponse.body);

    // Only parse if retrieval was successful
    if (httpResponse.status !== 200) {
      if (action.silenceErrors) {
        this.logWarn(action.context, `Server failure ${action.url} (${httpResponse.status})`,
          { actor: this.name });
        return { pageUrl: httpResponse.url, quads: new EmptyIterator(), triples: true };
      } else {
        throw new Error(`Server failure ${action.url} (${httpResponse.status})`);
      }
    }

    // Parse the resulting response
    const mediaType: string = ActorRdfDereferenceHttpParse.REGEX_MEDIATYPE
      .exec(httpResponse.headers.get('content-type'))[0];
    const parseAction: IActionRdfParse = { input: responseStream, baseIRI: httpResponse.url };
    let parseActionOutput: IActorOutputRootRdfParse;
    try {
      parseActionOutput = (await this.mediatorRdfParse.mediate(
        { context: action.context, handle: parseAction, handleMediaType: mediaType }));
      if (action.silenceErrors) {
        parseActionOutput.handle.quads.on('error', (e) => {
          this.logWarn(action.context, `Could not parse ${action.url} (${httpResponse.status})`,
            { actor: this.name });
        });
      }
    } catch (e) {
      if (action.silenceErrors) {
        this.logWarn(action.context, `Could not parse ${action.url} (${httpResponse.status}): ${e.message}`,
          { actor: this.name });
        return { pageUrl: httpResponse.url, quads: new EmptyIterator(), triples: true };
      } else {
        throw e;
      }
    }
    const parseOutput: IActorRdfParseOutput = parseActionOutput.handle;

    // Return the parsed quad stream and whether or not only triples are supported
    return { pageUrl: httpResponse.url, quads: parseOutput.quads, triples: parseOutput.triples };
  }

  public mediaTypesToAcceptString(mediaTypes: {[id: string]: number}): string {
    const parts: string[] = [];
    for (const mediaType in mediaTypes) {
      const priority: number = mediaTypes[mediaType];
      parts.push(mediaType + (priority !== 1 ? ';q=' + priority : ''));
    }
    if (!parts.length) {
      return '*/*';
    }
    return parts.join(', ');
  }

}

export interface IActorRdfDereferenceHttpParseArgs extends
  IActorArgs<IActionRdfDereference, IActorTest, IActorRdfDereferenceOutput> {
  mediatorHttp: Mediator<Actor<IActionHttp, IActorTest, IActorHttpOutput>,
    IActionHttp, IActorTest, IActorHttpOutput>;
  mediatorRdfParse: Mediator<Actor<IActionRootRdfParse, IActorTestRootRdfParse,
    IActorOutputRootRdfParse>, IActionRootRdfParse, IActorTestRootRdfParse, IActorOutputRootRdfParse>;
}
