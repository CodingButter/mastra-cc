// Disposable-container test executable; never part of the operator installation.
#include <csignal>
#include <fstream>
#include <string>
#include <unistd.h>
int main() {
    std::signal(SIGTERM, SIG_IGN);
    std::string mode;
    std::ifstream("/tmp/authorized-failure-mode") >> mode;
    int ready[2];
    if (pipe(ready)) return 2;
    const pid_t child = fork();
    if (child < 0) return 2;
    if (!child) {
        close(ready[0]);
        const char byte = 'R';
        if (write(ready[1], &byte, 1) != 1) return 2;
        close(ready[1]);
        while (true) pause();
    }
    close(ready[1]);
    char byte;
    if (read(ready[0], &byte, 1) != 1) return 2;
    close(ready[0]);
    { std::ofstream out("/tmp/authorized-failure-pids"); out << getpid() << ' ' << child << ' ' << getpgrp() << '\n'; }
    if (mode == "early-exit") return 1;
    if (mode == "malformed") { const char bad[4] = {0,0,0,0}; if (write(1,bad,4) != 4) return 2; return 0; }
    while (true) pause();
}
