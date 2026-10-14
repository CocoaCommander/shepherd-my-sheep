#include <gtest/gtest.h>
#include <sodium.h>

// Mirrors main.cpp: libsodium must be initialised before any hashing.
int main(int argc, char** argv) {
    if (sodium_init() < 0) {
        return 1;
    }
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
