import type { EvalSpec } from './types.js';

interface CodexSdkModule {
    Codex: new () => {
        startThread(options: {
            workingDirectory: string;
            sandboxMode: 'workspace-write';
            skipGitRepoCheck: boolean;
        }): {
            id: string | null;
            run(prompt: string): Promise<{ finalResponse: string }>;
        };
    };
}

export function buildCodexRegressionPrompt(spec: EvalSpec): string {
    return [
        'You are implementing one outcome-derived regression test for VetIOS ProofLoop.',
        '',
        'Safety and scope:',
        '- Work only in the provided repository workspace.',
        '- Inspect the existing test conventions before editing.',
        '- Add the smallest fixture and regression test that faithfully encode the supplied eval specification.',
        '- Do not weaken, skip, delete, or rewrite existing tests to make the new case pass.',
        '- Do not add clinical claims that are absent from the eval specification.',
        '- Run the narrowest relevant test command after editing.',
        '- Return the changed paths, commands run, test result, and any unresolved blocker.',
        '',
        `Eval specification digest: ${spec.spec_sha256}`,
        `Source Outcome Receipt digest: ${spec.source_receipt_sha256}`,
        '',
        'Eval specification:',
        '```json',
        JSON.stringify(spec, null, 2),
        '```',
    ].join('\n');
}

export async function runCodexRegressionTask(options: {
    targetRepository: string;
    spec: EvalSpec;
}): Promise<{ finalResponse: string; threadId: string | null }> {
    // Keep the SDK lazy so offline receipt/gate verification never requires Codex auth.
    const sdkPackage = '@openai/codex-sdk';
    const { Codex } = await import(sdkPackage) as unknown as CodexSdkModule;
    const codex = new Codex();
    const thread = codex.startThread({
        workingDirectory: options.targetRepository,
        sandboxMode: 'workspace-write',
        skipGitRepoCheck: false,
    });
    const result = await thread.run(buildCodexRegressionPrompt(options.spec));
    return {
        finalResponse: result.finalResponse,
        threadId: thread.id,
    };
}
