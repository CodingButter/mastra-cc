#define CAPTURE_TEST
#include "main.cpp"
#include <functional>
#include <limits>
#include <sys/wait.h>

void check(bool ok) { if (!ok) throw std::runtime_error("assertion failed"); }
void rejects(const std::function<void()> &fn) {
    bool rejected = false;
    try { fn(); } catch (const std::runtime_error &) { rejected = true; }
    check(rejected);
}
int main() {
    using namespace capture;
    const int format = QImage::Format_RGB32;
    rejects([&] { shape(0, 1, 4, format); });
    rejects([&] { shape(std::numeric_limits<quint64>::max(), 1, 4, format); });
    rejects([&] { shape(1, 1, 3, format); });
    rejects([&] { shape(1, cap, 4, format); });
    rejects([&] { shape(1, 1, 4, -1); });
    check(shape(1, cap / 4, 4, format).bytes == cap);
    rejects([&] { shape(1, cap / 4 + 1, 4, format); });
    std::vector<unsigned char> pixels(16);
    quint32 colors[] = {qRgb(10,20,30), 0, qRgb(40,50,60), 0};
    std::memcpy(pixels.data(), colors, 16);
    rgb(pixels, shape(1, 2, 8, format));
    check(pixels == std::vector<unsigned char>({10,20,30,40,50,60}));
    quint32 alpha = qPremultiply(qRgba(100, 50, 20, 128));
    pixels.resize(4); std::memcpy(pixels.data(), &alpha, 4);
    rgb(pixels, shape(1,1,4,QImage::Format_ARGB32_Premultiplied));
    check(pixels[0] >= 99 && pixels[0] <= 101);
    int fds[2]; check(pipe2(fds, O_NONBLOCK | O_CLOEXEC) == 0);
    Fd reader(fds[0]);
    { Fd writer(fds[1]); check(write(writer.value, "abcd", 4) == 4); }
    Stream first; first.drain(reader.value); check(first.eof && !first.complete());
    first.setExpected(4); check(first.complete());
    Stream second; second.setExpected(4); check(!second.complete());
    second.eof = true; rejects([&] { second.complete(); });
    rejects([&] { first.setExpected(3); });
    rejects([&] { second.setExpected(cap + 1); });
    QElapsedTimer clock; clock.start();
    cancelled = 1; rejects([&] { budget(clock); }); cancelled = 0;
    rejects([&] { budget(clock, 0); });
    int output[2]; check(pipe2(output, O_NONBLOCK | O_CLOEXEC) == 0);
    Fd sink(output[0]), source(output[1]);
    unsigned char chunk[8192]{};
    while (write(source.value, chunk, sizeof(chunk)) > 0) {}
    QElapsedTimer expired; expired.start();
    QThread::msleep(2);
    cancelled = 1; rejects([&] { writeAll(source.value, chunk, sizeof(chunk), expired); }); cancelled = 0;
    const pid_t child = fork(); check(child >= 0);
    if (child == 0) {
        close(source.value);
        size_t total = 0;
        while (total < 100000) {
            const auto n = read(sink.value, chunk, sizeof(chunk));
            if (n > 0) total += size_t(n); else usleep(1000);
        }
        _exit(0);
    }
    std::vector<unsigned char> data(100000);
    clock.restart(); writeAll(source.value, data.data(), data.size(), clock);
    int status; check(waitpid(child, &status, 0) == child && WIFEXITED(status) && WEXITSTATUS(status) == 0);
    std::puts("NATIVE: GREEN (arithmetic, formats, padding, alpha, ordering, EOF, bounds, cancellation, deadline, partial writes)");
}
