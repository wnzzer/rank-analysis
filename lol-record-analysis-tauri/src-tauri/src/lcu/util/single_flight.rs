use crossbeam_utils::sync::WaitGroup;
use hashbrown::HashMap;
use parking_lot::Mutex;
use std::fmt::Debug;

pub struct Group<T>
where
    T: Clone + Debug,
{
    inner: Mutex<HashMap<String, Box<Call<T>>>>,
}

impl<T> Group<T>
where
    T: Clone + Debug,
{
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// 执行一个函数，保证同一个 key 仅执行一次（并发安全）
    /// 如果已有任务在运行，当前调用会等待其完成并返回相同结果
    ///
    /// # Example
    /// ```
    /// let group = Group::<String>::new();
    /// let res = group.work("key", || {
    ///     println!("Running once!");
    ///     "hello".to_string()
    /// });
    /// ```
    pub fn work<F>(&self, key: &str, func: F) -> T
    where
        F: Fn() -> T,
    {
        let mut map = self.inner.lock();

        if let Some(call) = map.get(key) {
            drop(map); // 释放锁，防止死锁
            call.wg.wait(); // 等待原来的任务完成
            return call.res.as_ref().unwrap().clone(); // 返回结果副本
        }

        let call = Call::new();
        let wg = call.wg.clone();
        map.insert(key.to_owned(), Box::new(call));

        drop(map); // 关键：提前释放锁，让别人能进入并等待

        let result = func();

        let mut map = self.inner.lock();
        let c = map.remove(key).unwrap();
        drop(map);

        c.res.unwrap()
    }
}

#[derive(Clone)]
struct Call<T>
where
    T: Clone + Debug,
{
    wg: WaitGroup,
    res: Option<T>,
}

impl<T> Call<T>
where
    T: Clone + Debug,
{
    fn new() -> Self {
        Self {
            wg: WaitGroup::new(),
            res: None,
        }
    }
}

static G: OnceCell<Group<String>> = OnceCell::new();
pub fn single_work<T, F>(key: &str, func: F) -> T
where
    T: Clone + Debug + Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let group = G.get_or_init(|| Group::new());
    group.work(key, func)
}
