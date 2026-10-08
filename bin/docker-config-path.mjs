#!/usr/bin/env node
// Prints the docker config directory the scanners run against, creating it if absent.
//
// Exists so the shell lanes can reach lib/docker-config.mjs without restating the path. A second
// derivation in shell would be a second resolver for the same variable: the node entry points
// would go quiet and the container lanes would keep raising the App Data prompt, and the gap
// between them reads as a dialog nobody can attribute to a caller.

import { useScopedDockerConfig } from '../lib/docker-config.mjs';

process.stdout.write(useScopedDockerConfig());
