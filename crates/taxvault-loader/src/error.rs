use thiserror::Error;

#[derive(Debug, Error)]
pub enum LoaderError {
    #[error("JSON parse error: {0}")]
    JsonParse(#[from] serde_json::Error),

    #[error("TOML parse error: {0}")]
    TomlParse(#[from] toml::de::Error),

    #[error("CSV parse error: {0}")]
    CsvParse(#[from] csv::Error),

    #[error("validation error: {0}")]
    Validation(String),

    #[error("conversion error: {0}")]
    Conversion(String),

    #[error(
        "test vector {index} failed: {description}. Expected {field}={expected}, got {actual}"
    )]
    TestVectorFailed {
        index: usize,
        description: String,
        field: String,
        expected: String,
        actual: String,
    },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
