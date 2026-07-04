pub struct XorShift(u32);

impl XorShift {
    pub fn new(seed: u32) -> Self {
        XorShift(seed.max(1))
    }

    pub fn next(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }

    /// Uniform in [0, 1)
    pub fn next_f32(&mut self) -> f32 {
        (self.next() >> 8) as f32 / 16_777_216.0
    }
}
