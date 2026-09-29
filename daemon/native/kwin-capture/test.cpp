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
    const QString support = "Number of Screens: 1\n\nScreen 0:\n---------\nName: WL-0\nEnabled: 1\nGeometry: 0,0,1024x768\nPhysical size: -1x-1mm\nScale: 1\n";
    const QList<QPair<QRect, qreal>> qt{{QRect(0, 0, 1024, 768), 1.0}};
    const auto baseline = checkedLayout(support, qt);
    unchangedLayout(baseline, baseline);
    rejects([&] { checkedLayout(QString(support).replace("Screens: 1", "Screens: 2"), qt); });
    rejects([&] { checkedLayout(support, {qt[0], qt[0]}); });
    rejects([&] { checkedLayout(QString(support).replace("Scale: 1", "Scale: 1.5"), qt); });
    rejects([&] { checkedLayout(support, {{qt[0].first, 1.5}}); });
    rejects([&] { checkedLayout(support, {{qt[0].first, std::numeric_limits<qreal>::quiet_NaN()}}); });
    rejects([&] { checkedLayout(QString(support).replace("0,0,1024", "1,0,1024"), qt); });
    rejects([&] { checkedLayout(QString(support).replace("Enabled: 1", "Enabled: 0"), qt); });
    // A quarter-turn with contradictory Qt/compositor dimensions must refuse.
    rejects([&] { checkedLayout(QString(support).replace("1024x768", "768x1024"), qt); });
    rejects([&] { checkedLayout(support, {{QRect(0, 0, 768, 1024), 1.0}}); });
    for (const auto key : {"width", "height", "x", "y", "scale", "outputs"}) {
        auto changed = baseline; changed[key] = baseline[key].toInt() + 1;
        rejects([&] { unchangedLayout(baseline, changed); });
    }
    auto renamed = baseline; renamed["name"] = "WL-1";
    rejects([&] { unchangedLayout(baseline, renamed); });
    auto resized = checkedLayout(QString(support).replace("1024x768", "800x600"), {{QRect(0, 0, 800, 600), 1.0}});
    rejects([&] { unchangedLayout(baseline, resized); });
    captureScale({{"scale", 1.0}});
    rejects([&] { captureScale({}); });
    for (const QVariant &scale : {QVariant(1), QVariant("1"), QVariant(1.5), QVariant(std::numeric_limits<double>::quiet_NaN())})
        rejects([&] { captureScale({{"scale", scale}}); });
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
    // A Qt-owned duplicate keeps an empty pipe open before metadata arrives.
    int delayed[2]; check(pipe2(delayed, O_NONBLOCK | O_CLOEXEC) == 0);
    Fd delayedReader(delayed[0]);
    Stream delayedStream;
    {
        QDBusUnixFileDescriptor transferred(delayed[1]);
        check(transferred.isValid());
        close(delayed[1]);
        delayedStream.drain(delayedReader.value);
        check(!delayedStream.eof && !delayedStream.complete());
        delayedStream.setExpected(4);
        check(write(transferred.fileDescriptor(), "abcd", 4) == 4);
        delayedStream.drain(delayedReader.value);
        check(!delayedStream.eof && !delayedStream.complete());
    }
    delayedStream.drain(delayedReader.value);
    check(delayedStream.complete());
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
