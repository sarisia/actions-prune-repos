import * as core from "@actions/core"
import * as github from "@actions/github"
import { Repository } from "./models"

async function run() {
    // gather outputs
    const keepTopicsSet = (core.getMultilineInput("keep-topics") || [])
        .filter(v => v)
        .reduce((acc, cur) => acc.add(cur), new Set<string>())
    const retensionDays = parseInt(core.getInput("retension-days", { required: true }))
    const baseEpoch = parseFloat(core.getInput("base-epoch")) || (Date.now() / 1000)
    const deleteOlderThanEpoch = baseEpoch - (retensionDays * 60 * 60 * 24)
    const maskPrivateRepository = core.getBooleanInput("mask-private-repository", { required: true })
    const githubPAT = core.getInput("github-pat", { required: true })
    const dryRun = core.getBooleanInput("dry-run", { required: true })
    core.setSecret(githubPAT)

    core.debug(`keepTopicsSet: ${[...keepTopicsSet.keys()]}`)
    core.debug(`baseEpoch: ${baseEpoch}`)
    core.debug(`deleteOlderThanEpoch: ${deleteOlderThanEpoch}`)

    const octokit = github.getOctokit(githubPAT)

    // list all repositories
    const repos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
        affiliation: "owner"
    })

    // construct target list
    const targets: Repository[] = []
    for (const repo of repos) {
        core.debug(`Repository: ${repo.full_name}`)

        if (maskPrivateRepository && repo.private) {
            core.setSecret(repo.name)
        }

        // if keepTopic is set, skip.
        let skip = false
        for (const topic of repo.topics || []) {
            if (keepTopicsSet.has(topic)) {
                core.info(`Skip: ${repo.full_name} (has keep topic: ${topic})`)
                skip = true
                break
            }
        }
        if (skip) {
            continue
        }

        // if repo is younger than retension days, skip
        const pushedAt = new Date(repo.pushed_at || 0).valueOf() / 1000
        core.debug(`pushedAt: ${pushedAt}`)
        if (pushedAt > deleteOlderThanEpoch) {
            core.info(`Skip: ${repo.full_name} (has pushes in last ${retensionDays} days)`)
            continue
        }

        // ok this is deletable!
        core.warning(`Delete: ${repo.full_name}`)
        targets.push({ owner: repo.owner.login, repo: repo.name })
    }

    // if run mode, actually delete!
    if (dryRun) {
        core.info("Dry Run. Actual deletion skipped.")
    } else {
        core.info("Start deleting...")
        for (const target of targets) {
            core.info(`Deleting: ${target.owner}/${target.repo}`)
            try {
                await octokit.rest.repos.delete({ owner: target.owner, repo: target.repo })
            } catch (error: any) {
                if (error.status == 404) {
                    // already deleted
                    core.warning(`Seems already deleted?`)
                }
                else {
                    throw error
                }
            }
        }
    }

    // set output
    core.setOutput("base-epoch", baseEpoch)
    core.info("Done!")
}

run()
