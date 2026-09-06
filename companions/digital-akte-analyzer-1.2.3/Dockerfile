FROM digital-akte-analyzer:1.2.2

USER root
COPY app/repository.py /app/app/repository.py
COPY app/main.py /app/app/main.py
RUN chown analyzer:analyzer /app/app/repository.py /app/app/main.py
USER analyzer
