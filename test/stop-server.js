// Shut a spawned test server down and WAIT for it to be gone.
//
// `child.kill()` followed by the parent exiting immediately crashes Node on Windows
// roughly half the time:
//
//   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
//
// The child process handle is still closing when libuv tears the loop down. Every
// assertion in the test has already passed at that point, so the output looks fine — but
// the process exits with 0xC0000409 and `npm test`'s `&&` chain stops dead. That is how
// the later suites silently stopped running: not failing, just never reached.
//
// Waiting for 'close' (all stdio gone, process reaped) fixes it. The timeout stops a
// wedged child hanging the suite forever.
function stopServer(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // A real timer tick, not setImmediate: the child's stdio and process handles are
      // still being closed when 'close' fires, and exiting inside that window is what
      // trips the assertion. 60ms is invisible in a suite that spawns servers anyway.
      setTimeout(resolve, 60);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish();
    }, timeoutMs);
    child.once('close', finish);
    child.once('error', finish);
    try { child.kill(); } catch { finish(); }
  });
}

module.exports = { stopServer };
